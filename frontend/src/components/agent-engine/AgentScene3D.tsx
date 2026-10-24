import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { AgentNodeId, NormalizedEngineState } from '../../types/agent-engine';
import {
  AGENT_METADATA,
  DEFAULT_CONDUITS,
  getStatusColor,
} from '../../lib/agentEngineAdapter';

interface AgentScene3DProps {
  state: NormalizedEngineState;
  selectedNodeId: AgentNodeId | null;
  onSelectNode: (id: AgentNodeId) => void;
  onWebGLError?: (err: Error) => void;
  className?: string;
  isExpanded?: boolean;
}

export const AgentScene3D: React.FC<AgentScene3DProps> = ({
  state,
  selectedNodeId,
  onSelectNode,
  onWebGLError,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const frameIdRef = useRef<number | null>(null);

  // Mesh and group registries for state updates without recreating scene
  const nodeGroupsRef = useRef<Map<AgentNodeId, THREE.Group>>(new Map());
  const orbMeshesRef = useRef<Map<AgentNodeId, THREE.Mesh>>(new Map());
  const ringMeshesRef = useRef<Map<AgentNodeId, THREE.Mesh[]>>(new Map());
  const conduitLinesRef = useRef<Map<string, THREE.Line>>(new Map());
  const conduitPacketsRef = useRef<Map<string, THREE.Mesh>>(new Map());

  // Interactive mouse tracking
  const mouseRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 });
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const pointerRef = useRef<THREE.Vector2>(new THREE.Vector2());

  const [hoveredNode, setHoveredNode] = useState<AgentNodeId | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [fps, setFps] = useState<number>(60);

  // Check prefers-reduced-motion safely for SSR/test environments
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Update node visual materials based on live runtime state
  const updateNodeVisuals = useCallback(() => {
    (Object.keys(AGENT_METADATA) as AgentNodeId[]).forEach((id) => {
      const nodeState = state.nodes[id];
      const isSelected = selectedNodeId === id;
      const isActive = state.activeNodeId === id || nodeState.status === 'active';
      const colorHex = new THREE.Color(getStatusColor(nodeState.status));

      // 1. Maintain the Core 3D Orb as Obsidian Black with specular sheen
      const orb = orbMeshesRef.current.get(id);
      if (orb && orb.material instanceof THREE.MeshStandardMaterial) {
        orb.material.color.setHex(0x18181b); // Obsidian black
        orb.material.roughness = 0.2;
        orb.material.metalness = 0.85;

        // Subtle dynamic emissive rim lighting based on active status
        if (isActive) {
          orb.material.emissive.copy(colorHex);
          orb.material.emissiveIntensity = 0.35;
        } else if (isSelected) {
          orb.material.emissive.copy(colorHex);
          orb.material.emissiveIntensity = 0.2;
        } else if (nodeState.status === 'completed') {
          orb.material.emissive.setHex(0x16a34a);
          orb.material.emissiveIntensity = 0.15;
        } else {
          orb.material.emissive.setHex(0x000000);
          orb.material.emissiveIntensity = 0;
        }
      }

      // 2. Drive the surrounding orbital rings / halos with the agent's live status color
      const rings = ringMeshesRef.current.get(id);
      if (rings && rings.length > 0) {
        rings.forEach((ringMesh) => {
          if (ringMesh.material instanceof THREE.MeshBasicMaterial) {
            if (ringMesh.name.includes('halo')) {
              // Outer halo ring
              ringMesh.material.color.copy(colorHex);
              ringMesh.material.opacity = isActive ? 0.95 : isSelected ? 0.8 : 0.3;
            } else if (ringMesh.name.includes('accent')) {
              ringMesh.material.color.copy(colorHex);
              ringMesh.material.opacity = isActive ? 1.0 : 0.5;
            } else {
              ringMesh.material.color.set(isSelected || isActive ? colorHex : 0xdfd7c7);
              ringMesh.material.opacity = isActive ? 0.9 : 0.45;
            }
          }
        });
      }
    });

    // Update Conduits
    state.conduits.forEach((conduit) => {
      const key = `${conduit.from}-${conduit.to}`;
      const line = conduitLinesRef.current.get(key);
      const packet = conduitPacketsRef.current.get(key);

      if (line && line.material instanceof THREE.LineBasicMaterial) {
        if (conduit.isActive) {
          line.material.color.set(getStatusColor(conduit.status));
          line.material.opacity = 0.9;
        } else {
          line.material.color.set(0xdfd7c7);
          line.material.opacity = 0.35;
        }
      }

      if (packet) {
        packet.visible = conduit.isActive && !reducedMotion;
        if (conduit.isActive && packet.material instanceof THREE.MeshBasicMaterial) {
          packet.material.color.set(getStatusColor(conduit.status));
        }
      }
    });
  }, [state, selectedNodeId, reducedMotion]);

  useEffect(() => {
    updateNodeVisuals();
  }, [updateNodeVisuals]);

  // Main Three.js Scene Setup & Render Loop
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      // Clean, warm architectural studio beige background
      renderer.setClearColor(new THREE.Color(0xf5efeb), 1);
      rendererRef.current = renderer;
      container.appendChild(renderer.domElement);
    } catch (err: any) {
      console.warn('WebGL initialization failed, switching to 2D accessible fallback:', err);
      onWebGLError?.(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      42,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    );
    camera.position.set(0, 0.4, 12.0);
    cameraRef.current = camera;

    // Ambient & Directional Lighting for Warm Studio Setup
    const ambientLight = new THREE.AmbientLight(0xfffbf5, 1.4);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight1.position.set(6, 12, 8);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xe2e8f0, 0.6);
    dirLight2.position.set(-6, -6, 5);
    scene.add(dirLight2);

    // Subtle Architectural Ground Grid
    const grid = new THREE.GridHelper(24, 32, 0xd4cbb9, 0xece6dc);
    grid.position.set(0, -0.6, -1.8);
    grid.rotation.x = Math.PI / 2.35;
    scene.add(grid);

    // Build Agent Nodes (Each 3D Orb denotes ONE Agent)
    const nodeHitboxes: THREE.Object3D[] = [];

    (Object.keys(AGENT_METADATA) as AgentNodeId[]).forEach((id) => {
      const meta = AGENT_METADATA[id];
      const group = new THREE.Group();
      group.position.set(...meta.position3D);
      group.name = `node_${id}`;

      const rings: THREE.Mesh[] = [];

      // Primary Black Orb Geometry
      const isOrchestrator = id === 'orchestrator';
      const orbRadius = isOrchestrator ? 0.72 : 0.58;

      const orbGeo = new THREE.SphereGeometry(orbRadius, 36, 36);
      const orbMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x18181b), // Sleek obsidian black
        roughness: 0.22,
        metalness: 0.88,
      });
      const orbMesh = new THREE.Mesh(orbGeo, orbMat);
      orbMesh.name = `orb_${id}`;
      group.add(orbMesh);
      orbMeshesRef.current.set(id, orbMesh);

      // Surrounding Orbital Accent Rings according to Agent Role
      if (id === 'orchestrator') {
        // Central Gyroscope Dual Orbital Rings
        const ringGeo1 = new THREE.RingGeometry(1.15, 1.20, 64);
        const ringMat1 = new THREE.MeshBasicMaterial({
          color: new THREE.Color(0xd4cbb9),
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.7,
        });
        const ringMesh1 = new THREE.Mesh(ringGeo1, ringMat1);
        ringMesh1.name = 'orbit_ring1';
        group.add(ringMesh1);
        rings.push(ringMesh1);

        const ringGeo2 = new THREE.RingGeometry(1.35, 1.40, 64);
        const ringMat2 = new THREE.MeshBasicMaterial({
          color: new THREE.Color(0xd4cbb9),
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.5,
        });
        const ringMesh2 = new THREE.Mesh(ringGeo2, ringMat2);
        ringMesh2.rotation.x = Math.PI / 3;
        ringMesh2.name = 'orbit_ring2';
        group.add(ringMesh2);
        rings.push(ringMesh2);
      } else if (id === 'investigation') {
        // Investigation Orb with Concentric Scanning Latitude Rings
        const scanGeo = new THREE.RingGeometry(0.85, 0.89, 48);
        const scanMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(0xd4cbb9),
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.6,
        });
        const scanMesh = new THREE.Mesh(scanGeo, scanMat);
        scanMesh.name = 'scan_ring';
        group.add(scanMesh);
        rings.push(scanMesh);
      } else if (id === 'hypothesis') {
        // Hypothesis Orb with 3 Branching Satellites
        const haloGeo = new THREE.RingGeometry(0.85, 0.89, 48);
        const haloMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(0xd4cbb9),
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.6,
        });
        const haloMesh = new THREE.Mesh(haloGeo, haloMat);
        haloMesh.name = 'hypo_halo';
        group.add(haloMesh);
        rings.push(haloMesh);

        // Satellites
        const angles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
        angles.forEach((angle, idx) => {
          const satGeo = new THREE.SphereGeometry(0.12, 16, 16);
          const satMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(0x18181b),
            roughness: 0.25,
            metalness: 0.8,
          });
          const satMesh = new THREE.Mesh(satGeo, satMat);
          satMesh.position.set(Math.cos(angle) * 0.95, Math.sin(angle) * 0.95, 0);
          satMesh.name = `sat_${idx}`;
          group.add(satMesh);
        });
      } else if (id === 'policy') {
        // Policy Gate Orb with Protective Segmented Gate Ring
        const gateGeo = new THREE.RingGeometry(0.92, 0.98, 48);
        const gateMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(0xd4cbb9),
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.6,
        });
        const gateMesh = new THREE.Mesh(gateGeo, gateMat);
        gateMesh.name = 'policy_gate';
        group.add(gateMesh);
        rings.push(gateMesh);
      } else if (id === 'remediation') {
        // Remediation Orb with Action Conduit Ring
        const actGeo = new THREE.RingGeometry(0.88, 0.93, 48);
        const actMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(0xd4cbb9),
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.6,
        });
        const actMesh = new THREE.Mesh(actGeo, actMat);
        actMesh.name = 'action_ring';
        group.add(actMesh);
        rings.push(actMesh);
      } else if (id === 'verification') {
        // Verification Orb with Precision Dual Reticle Rings
        const verGeo1 = new THREE.RingGeometry(0.85, 0.89, 48);
        const verMat1 = new THREE.MeshBasicMaterial({
          color: new THREE.Color(0xd4cbb9),
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.6,
        });
        const verMesh1 = new THREE.Mesh(verGeo1, verMat1);
        verMesh1.name = 'ver_reticle1';
        group.add(verMesh1);
        rings.push(verMesh1);

        const verGeo2 = new THREE.RingGeometry(1.05, 1.09, 48);
        const verMat2 = new THREE.MeshBasicMaterial({
          color: new THREE.Color(0xd4cbb9),
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.4,
        });
        const verMesh2 = new THREE.Mesh(verGeo2, verMat2);
        verMesh2.name = 'ver_reticle2';
        group.add(verMesh2);
        rings.push(verMesh2);
      }

      // Outer Selection Halo for click focus
      const selHaloGeo = new THREE.RingGeometry(orbRadius + 0.35, orbRadius + 0.39, 48);
      const selHaloMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0x0d9488),
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
      });
      const selHaloMesh = new THREE.Mesh(selHaloGeo, selHaloMat);
      selHaloMesh.name = `halo_${id}`;
      group.add(selHaloMesh);
      rings.push(selHaloMesh);

      // Invisible Raycasting Hitbox for reliable click/hover interaction
      const hitboxGeo = new THREE.SphereGeometry(1.2, 12, 12);
      const hitboxMat = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        wireframe: false,
      });
      const hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
      hitbox.userData = { nodeId: id };
      group.add(hitbox);
      nodeHitboxes.push(hitbox);

      ringMeshesRef.current.set(id, rings);
      nodeGroupsRef.current.set(id, group);
      scene.add(group);
    });

    // Build Inter-Node Conduits
    DEFAULT_CONDUITS.forEach((conduit) => {
      const fromMeta = AGENT_METADATA[conduit.from];
      const toMeta = AGENT_METADATA[conduit.to];

      const p1 = new THREE.Vector3(...fromMeta.position3D);
      const p2 = new THREE.Vector3(...toMeta.position3D);

      const points = [p1, p2];
      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(0xdfd7c7),
        transparent: true,
        opacity: 0.35,
        linewidth: 1.5,
      });
      const line = new THREE.Line(lineGeo, lineMat);
      const key = `${conduit.from}-${conduit.to}`;
      conduitLinesRef.current.set(key, line);
      scene.add(line);

      // Moving Data Packet along conduit
      const packetGeo = new THREE.SphereGeometry(0.12, 12, 12);
      const packetMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0x0d9488),
      });
      const packet = new THREE.Mesh(packetGeo, packetMat);
      packet.visible = false;
      conduitPacketsRef.current.set(key, packet);
      scene.add(packet);
    });

    // Pointer Interaction Event Listeners
    const handlePointerMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      pointerRef.current.set(x, y);
      mouseRef.current.targetX = x * 0.45;
      mouseRef.current.targetY = y * 0.35;

      // Raycast for hover
      raycasterRef.current.setFromCamera(pointerRef.current, camera);
      const intersects = raycasterRef.current.intersectObjects(nodeHitboxes);

      if (intersects.length > 0) {
        const targetId = intersects[0].object.userData.nodeId as AgentNodeId;
        setHoveredNode(targetId);
        container.style.cursor = 'pointer';
      } else {
        setHoveredNode(null);
        container.style.cursor = 'default';
      }
    };

    const handleClick = () => {
      raycasterRef.current.setFromCamera(pointerRef.current, camera);
      const intersects = raycasterRef.current.intersectObjects(nodeHitboxes);

      if (intersects.length > 0) {
        const targetId = intersects[0].object.userData.nodeId as AgentNodeId;
        onSelectNode(targetId);
      }
    };

    container.addEventListener('mousemove', handlePointerMove);
    container.addEventListener('click', handleClick);

    // Resize Handler
    const handleResize = () => {
      if (!container || !rendererRef.current || !cameraRef.current) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);

    // Animation Loop with Visibility Throttling
    const clock = new THREE.Clock();
    let frameCount = 0;
    let lastFpsUpdate = performance.now();
    let isTabVisible = !document.hidden;

    const handleVisibility = () => {
      isTabVisible = !document.hidden;
    };
    document.addEventListener('visibilitychange', handleVisibility);

    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);

      if (!isTabVisible) return;

      clock.getDelta();
      const time = clock.getElapsedTime();

      // Measure actual FPS
      frameCount++;
      const now = performance.now();
      if (now - lastFpsUpdate >= 1000) {
        setFps(Math.round((frameCount * 1000) / (now - lastFpsUpdate)));
        frameCount = 0;
        lastFpsUpdate = now;
      }

      // Smooth camera parallax
      if (!reducedMotion) {
        mouseRef.current.x += (mouseRef.current.targetX - mouseRef.current.x) * 0.05;
        mouseRef.current.y += (mouseRef.current.targetY - mouseRef.current.y) * 0.05;
        camera.position.x = mouseRef.current.x * 0.6;
        camera.position.y = mouseRef.current.y * 0.6;
        camera.lookAt(0, 0.1, 0);
      }

      // Procedural Node Motions
      (Object.keys(AGENT_METADATA) as AgentNodeId[]).forEach((id) => {
        const group = nodeGroupsRef.current.get(id);
        const nodeState = state.nodes[id];
        const isActive = state.activeNodeId === id || nodeState.status === 'active';

        if (group) {
          if (!reducedMotion) {
            // Subtle breathing floating motion
            const floatOffset = Math.sin(time * 1.5 + (id.charCodeAt(0) % 5)) * 0.04;
            group.position.y = AGENT_METADATA[id].position3D[1] + floatOffset;

            // Rotate orbital rings
            const r1 = group.getObjectByName('orbit_ring1');
            const r2 = group.getObjectByName('orbit_ring2');
            const scan = group.getObjectByName('scan_ring');
            const gate = group.getObjectByName('policy_gate');
            const ver1 = group.getObjectByName('ver_reticle1');
            const ver2 = group.getObjectByName('ver_reticle2');

            if (r1) r1.rotation.z = time * (isActive ? 0.7 : 0.2);
            if (r2) r2.rotation.z = -time * (isActive ? 0.6 : 0.15);
            if (scan) scan.rotation.z = time * (isActive ? 1.0 : 0.2);
            if (gate) gate.rotation.z = time * (isActive ? 0.8 : 0.15);
            if (ver1) ver1.rotation.z = time * (isActive ? 0.9 : 0.2);
            if (ver2) ver2.rotation.z = -time * (isActive ? 0.7 : 0.15);

            // Rotate hypothesis constellation satellites
            if (id === 'hypothesis') {
              for (let i = 0; i < 3; i++) {
                const sat = group.getObjectByName(`sat_${i}`);
                if (sat) {
                  const baseAngle = (i * 2 * Math.PI) / 3 + time * (isActive ? 1.2 : 0.3);
                  sat.position.set(Math.cos(baseAngle) * 0.95, Math.sin(baseAngle) * 0.95, 0.08);
                }
              }
            }
          }
        }
      });

      // Animate Active Conduit Packets
      if (!reducedMotion) {
        state.conduits.forEach((conduit) => {
          const key = `${conduit.from}-${conduit.to}`;
          const packet = conduitPacketsRef.current.get(key);

          if (packet && packet.visible) {
            const p1 = new THREE.Vector3(...AGENT_METADATA[conduit.from].position3D);
            const p2 = new THREE.Vector3(...AGENT_METADATA[conduit.to].position3D);
            const progress = (time * 0.9) % 1;
            packet.position.lerpVectors(p1, p2, progress);
          }
        });
      }

      renderer.render(scene, camera);
    };

    animate();

    // Comprehensive Cleanup on Unmount
    return () => {
      if (frameIdRef.current) cancelAnimationFrame(frameIdRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('resize', handleResize);
      container.removeEventListener('mousemove', handlePointerMove);
      container.removeEventListener('click', handleClick);

      // Dispose geometries & materials
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material?.dispose();
          }
        }
      });

      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [reducedMotion]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full min-h-[460px] bg-[#F5EFEB] overflow-hidden select-none border border-[#DFD7C7] ${className}`}
      data-testid="agent-scene-3d-canvas"
    >
      {/* Non-overlapping HUD Header Bar */}
      <div className="absolute top-3 inset-x-4 z-10 flex items-center justify-between pointer-events-none">
        {/* Left: Engine & Technology Pill */}
        <div className="flex items-center gap-2 bg-[#FAF6F0]/90 backdrop-blur border border-[#DFD7C7] px-2.5 py-1 rounded shadow-sm">
          <span className="w-2 h-2 rounded-full bg-[#0D9488] animate-pulse" />
          <span className="text-[10px] font-mono tracking-wider text-[#1C1917] uppercase font-bold">
            PROOFLOOP // 3D AGENT ENGINE
          </span>
          <span className="text-[9px] font-mono text-[#6B6255] border-l border-[#DFD7C7] pl-2 hidden sm:inline">
            BLACK ORB MATRIX
          </span>
        </div>

        {/* Center: Stage Pill with zero overlapping */}
        <div className="bg-[#FAF6F0]/90 backdrop-blur border border-[#DFD7C7] px-3 py-1 rounded shadow-sm flex items-center gap-2">
          <span className="text-[9px] font-mono text-[#6B6255] uppercase">STAGE:</span>
          <span className="text-[10px] font-mono text-[#1C1917] font-bold uppercase truncate max-w-[200px] sm:max-w-none">
            {state.currentWorkflowStage}
          </span>
        </div>

        {/* Right: FPS & Health Pill */}
        <div className="flex items-center gap-2 bg-[#FAF6F0]/90 backdrop-blur border border-[#DFD7C7] px-2.5 py-1 rounded shadow-sm">
          <span className="text-[9px] font-mono font-bold text-[#1C1917]">{fps} FPS</span>
        </div>
      </div>

      {/* Floating Node Labels inside 3D Scene viewport */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {(Object.keys(AGENT_METADATA) as AgentNodeId[]).map((nodeId) => {
          const meta = AGENT_METADATA[nodeId];
          const nodeState = state.nodes[nodeId];
          const isSelected = selectedNodeId === nodeId;
          const isActive = state.activeNodeId === nodeId || nodeState.status === 'active';

          // Convert 3D positions to screen coordinates centered at (0, 0.4, 12.0)
          // Normalized percentages for center-aligned HUD badges
          const leftPct = 50 + (meta.position3D[0] / 9.0) * 50;
          const topPct = 50 - ((meta.position3D[1] - 0.4) / 6.6) * 50;

          return (
            <div
              key={nodeId}
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                transform: 'translate(-50%, 36px)',
              }}
              className="absolute pointer-events-none flex flex-col items-center gap-0.5 transition-all duration-300"
            >
              <div
                className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold tracking-wider uppercase flex items-center gap-1.5 transition-all shadow-sm ${
                  isSelected
                    ? 'bg-[#1C1917] text-[#FAF6F0] ring-1 ring-[#1C1917]'
                    : isActive
                    ? 'bg-[#FFFFFF] text-[#1C1917] border border-[#0D9488]'
                    : 'bg-[#FAF6F0]/90 text-[#6B6255] border border-[#DFD7C7]'
                }`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: getStatusColor(nodeState.status) }}
                />
                <span>{meta.label}</span>
              </div>
              <span
                className="text-[8px] font-mono font-semibold uppercase"
                style={{ color: getStatusColor(nodeState.status) }}
              >
                [{nodeState.statusLabel}]
              </span>
            </div>
          );
        })}
      </div>

      {/* Hover tooltip for node */}
      {hoveredNode && (
        <div className="absolute bottom-4 left-4 z-10 bg-[#FFFFFF]/95 backdrop-blur-sm border border-[#DFD7C7] px-3 py-2 text-xs font-mono pointer-events-none shadow-md rounded">
          <div className="text-[#1C1917] font-bold uppercase flex items-center gap-2">
            <span>{AGENT_METADATA[hoveredNode].label}</span>
            <span
              className="text-[9px] px-1.5 py-0.2 rounded font-semibold"
              style={{
                backgroundColor: `${getStatusColor(state.nodes[hoveredNode].status)}20`,
                color: getStatusColor(state.nodes[hoveredNode].status),
              }}
            >
              [{state.nodes[hoveredNode].statusLabel}]
            </span>
          </div>
          <div className="text-[10px] text-[#6B6255] mt-0.5 max-w-xs leading-snug">
            {AGENT_METADATA[hoveredNode].role}
          </div>
        </div>
      )}
    </div>
  );
};
