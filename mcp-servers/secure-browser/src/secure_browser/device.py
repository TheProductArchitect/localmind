import os
import sys


def get_optimal_device() -> str:
    env_device = os.getenv("SECURE_BROWSER_DEVICE")
    if env_device in {"cuda", "mps", "cpu"}:
        return env_device

    try:
        import torch
    except ImportError:
        return "cpu"

    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def log_device(device: str) -> None:
    print(f"[secure-browser-mcp] gatekeeper device: {device}", file=sys.stderr)
