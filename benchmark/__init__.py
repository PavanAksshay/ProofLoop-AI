"""ProofLoop AI Benchmark Suite.

Compares policy-governed ProofLoop incident resolution against a scripted baseline.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure 'backend' directory is in sys.path so 'app.*' imports resolve cleanly
backend_dir = Path(__file__).resolve().parent.parent / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))
