# ProofLoop AI — Dataset Directory Structure

This directory houses dataset manifests, CI regression fixtures, and adapters for evaluating ProofLoop AI on real-world operational datasets.

---

## Directory Organization

```text
datasets/
├── README.md                           # This guide
├── manifests/                          # Verified dataset provenance manifests
│   └── cloud_opsbench.json             # Official Cloud-OpsBench v1.0.0 metadata
├── fixtures/                           # Offline synthetic fixtures for CI and unit tests
│   └── cloud_opsbench_sample.json      # Representative microservice incident fixtures
├── downloaded/                         # [GIT-IGNORED] Full dataset downloads
└── raw/                                # [GIT-IGNORED] Unprocessed source logs / dumps
```

---

## Cloud-OpsBench Integration

ProofLoop AI integrates with **Cloud-OpsBench** (`LLM4Ops/Cloud-OpsBench`), a benchmark evaluating agentic root-cause analysis on Kubernetes microservices using a state snapshot paradigm.

### Provenance and Verification
- **Upstream Repository**: [https://github.com/LLM4Ops/Cloud-OpsBench](https://github.com/LLM4Ops/Cloud-OpsBench)
- **Hugging Face Hub**: [https://huggingface.co/datasets/LLM4Ops/Cloud-OpsBench](https://huggingface.co/datasets/LLM4Ops/Cloud-OpsBench)
- **Distribution Version**: `v1.0.0`
- **Source Commit**: `ea05dafbc87b5985df8721622d63d4229c2b4224`
- **License**: MIT License (Permissive)
- **Total Cases**: 754 cases (550 Online Boutique, 204 Train-Ticket)

For full licensing terms and provenance details, see [docs/DATASET_LICENSES_AND_PROVENANCE.md](../docs/DATASET_LICENSES_AND_PROVENANCE.md).

---

## Offline Testing vs Full Evaluation

1. **Unit & CI Testing (Offline)**:
   Unit tests utilize `datasets/fixtures/cloud_opsbench_sample.json`. This provides instant, deterministic execution without network dependencies.

2. **Full Benchmark Evaluation**:
   To download the official 754-case dataset:
   ```bash
   pip install huggingface_hub
   python -c "from huggingface_hub import snapshot_download; snapshot_download('LLM4Ops/Cloud-OpsBench', repo_type='dataset', local_dir='datasets/downloaded/cloud_opsbench')"
   ```
   Then run the benchmark evaluator pointing to the downloaded directory:
   ```bash
   python -m benchmark.cli --dataset cloud_opsbench --dataset-path datasets/downloaded/cloud_opsbench
   ```
