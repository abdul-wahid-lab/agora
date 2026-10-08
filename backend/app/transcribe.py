"""
On-device voice-message transcription (design reference 9.3's "hold to
transcribe"). Fully offline: av decodes the recorded .webm straight to PCM
in-process (no system ffmpeg install required, it ships its own), and
pywhispercpp runs a local whisper.cpp model against that PCM - the audio
itself never leaves this device. The one exception, consistent with how
this app's own update-checker already touches the internet (see api.py's
UpdatesModal flow): the model file itself is downloaded once, the first
time transcription is ever used, and cached locally after that.

"base" (a multilingual model, ~142MB) is used rather than tiny.en, since
real conversations aren't guaranteed to be in English - a noticeably
better accuracy/size trade-off for a general chat app than the English-
only variant.
"""

import asyncio

import numpy as np

_model = None
_model_lock = asyncio.Lock()


def _load_model():
    global _model
    if _model is None:
        from pywhispercpp.model import Model

        _model = Model("base")
    return _model


def _decode_to_pcm(path: str) -> np.ndarray:
    import av

    container = av.open(path)
    stream = container.streams.audio[0]
    resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)

    chunks = []
    for frame in container.decode(stream):
        for rframe in resampler.resample(frame):
            chunks.append(rframe.to_ndarray())
    container.close()

    if not chunks:
        return np.zeros(0, dtype=np.float32)
    pcm = np.concatenate(chunks, axis=1).flatten().astype(np.float32) / 32768.0
    return pcm


def _transcribe_sync(path: str) -> str:
    model = _load_model()
    pcm = _decode_to_pcm(path)
    if pcm.size == 0:
        return ""
    segments = model.transcribe(pcm)
    return " ".join(s.text for s in segments).strip()


async def transcribe_file(path: str) -> str:
    """Runs the actual decode+inference in a worker thread (both are
    CPU-bound, would otherwise block the event loop), serialized behind a
    lock since the underlying whisper.cpp context isn't meant to run two
    transcriptions at once."""
    async with _model_lock:
        return await asyncio.to_thread(_transcribe_sync, path)
