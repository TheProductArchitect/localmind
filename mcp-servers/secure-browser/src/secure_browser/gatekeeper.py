from dataclasses import dataclass
from typing import Optional

from .device import get_optimal_device, log_device

_scanner = None  # lazy — model loads on first call so cold start of the MCP is cheap


@dataclass
class Verdict:
    safe: bool
    risk_score: float
    reason: Optional[str] = None


def _get_scanner():
    global _scanner
    if _scanner is not None:
        return _scanner

    device = get_optimal_device()
    log_device(device)

    # llm-guard's PromptInjection scanner wraps a small DeBERTa-class model.
    # We import lazily so the MCP server can boot before the model is pulled
    # from the HF cache.
    from llm_guard.input_scanners import PromptInjection
    from llm_guard.input_scanners.prompt_injection import MatchType

    # Newer llm-guard versions accept a `device` kwarg; older ones read the
    # PyTorch default. Try the explicit path first.
    try:
        _scanner = PromptInjection(threshold=0.5, match_type=MatchType.FULL, device=device)
    except TypeError:
        _scanner = PromptInjection(threshold=0.5, match_type=MatchType.FULL)
    return _scanner


def scan(text: str) -> Verdict:
    if not text or not text.strip():
        return Verdict(safe=True, risk_score=0.0)

    scanner = _get_scanner()
    _sanitized, is_valid, risk_score = scanner.scan(text)
    if is_valid:
        return Verdict(safe=True, risk_score=float(risk_score))
    return Verdict(
        safe=False,
        risk_score=float(risk_score),
        reason="prompt_injection_detected",
    )
