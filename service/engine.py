"""CPU Basic Pitch transcription, with no external inference API.

The ONNX weights are the Apache-2.0 Spotify Basic Pitch 0.4.0 release.
Only its model is extracted; this small NumPy/SciPy inference adapter avoids
the upstream package's TensorFlow dependency on Python 3.12. Model bootstrapping
is explicit, checksum verified, and separate from handling uploaded audio.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import math
from pathlib import Path
import tempfile
import threading
import urllib.request
import zipfile

import numpy as np
import onnxruntime as ort
from scipy.signal import find_peaks, resample_poly
import soundfile as sf

MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_PATH = MODEL_DIR / "basic-pitch-0.4.0.onnx"
MODEL_SHA256 = "2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec"
WHEEL_URL = "https://files.pythonhosted.org/packages/99/0e/3a36d22562daeb0ae3c78ac78da3f8dba96543c5576ed57d4acb8ddbab5b/basic_pitch-0.4.0-py2.py3-none-any.whl"
WHEEL_SHA256 = "738adb503aae7fdfc7d1e1511aa0ce35052315f260a19531ef4c356708425db0"
SAMPLE_RATE = 22050
FFT_HOP = 256
WINDOW_SAMPLES = 43844
OVERLAP_FRAMES = 30
MAX_SECONDS = 60.0
_session: ort.InferenceSession | None = None
_session_lock = threading.Lock()


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def model_available() -> bool:
    """True only for the expected intact model; this never performs network I/O."""
    try:
        return _sha256(MODEL_PATH.read_bytes()) == MODEL_SHA256
    except OSError:
        return False


def ensure_model() -> Path:
    if not model_available():
        raise FileNotFoundError("Verified Basic Pitch model is missing. Run python service/engine.py --download-model during setup.")
    return MODEL_PATH


def download_model() -> Path:
    """Fetch a pinned verified release over the inherited HTTPS proxy/CA trust."""
    if model_available():
        return MODEL_PATH
    request = urllib.request.Request(WHEEL_URL, headers={"User-Agent": "Isai-model-setup/1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read(2_000_001)
    if len(data) > 2_000_000 or _sha256(data) != WHEEL_SHA256:
        raise ValueError("Basic Pitch release checksum mismatch; model was not installed.")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        model = archive.read("basic_pitch/saved_models/icassp_2022/nmp.onnx")
        if _sha256(model) != MODEL_SHA256:
            raise ValueError("Basic Pitch model checksum mismatch; model was not installed.")
        license_text = archive.read("basic_pitch-0.4.0.dist-info/LICENSE")
        notice_text = archive.read("basic_pitch-0.4.0.dist-info/NOTICE")
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    # Atomic writes leave an interrupted bootstrap visibly incomplete.
    for path, contents in [(MODEL_PATH, model), (MODEL_DIR / "LICENSE", license_text), (MODEL_DIR / "NOTICE", notice_text)]:
        with tempfile.NamedTemporaryFile(dir=MODEL_DIR, delete=False) as handle:
            handle.write(contents)
            temporary = Path(handle.name)
        temporary.replace(path)
    return ensure_model()


def _get_session() -> ort.InferenceSession:
    global _session
    with _session_lock:
        if _session is None:
            path = ensure_model()
            options = ort.SessionOptions()
            options.intra_op_num_threads = 2
            options.inter_op_num_threads = 1
            options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            _session = ort.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])
        return _session


def _read_excerpt(path: str | Path, start: float, end: float | None) -> tuple[np.ndarray, float, float]:
    if not math.isfinite(start) or start < 0:
        raise ValueError("Start must be a finite nonnegative number.")
    try:
        with sf.SoundFile(str(path)) as handle:
            duration = len(handle) / handle.samplerate
            source_end = duration if end is None else end
            if not math.isfinite(source_end) or source_end <= start or start >= duration:
                raise ValueError("The selected audio range is invalid or outside the file.")
            if source_end > duration + 0.03:
                raise ValueError("The selected end is outside the audio file.")
            source_end = min(source_end, duration)
            if source_end - start > MAX_SECONDS + 0.001:
                raise ValueError("Select at most 60 seconds of audio.")
            if source_end - start < 0.15:
                raise ValueError("Select at least 0.15 seconds of audio.")
            handle.seek(int(start * handle.samplerate))
            audio = handle.read(frames=int((source_end-start) * handle.samplerate), dtype="float32", always_2d=True).mean(axis=1)
            original_rate = handle.samplerate
    except (sf.LibsndfileError, RuntimeError) as error:
        raise ValueError("The decoded audio file cannot be read.") from error
    if not np.isfinite(audio).all():
        raise ValueError("Audio contains non-finite samples.")
    if original_rate != SAMPLE_RATE:
        divisor = math.gcd(original_rate, SAMPLE_RATE)
        audio = resample_poly(audio, SAMPLE_RATE//divisor, original_rate//divisor).astype(np.float32)
    return audio, float(start), float(source_end)


def _predict_frames(audio: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Overlapped 2-second windows using the model's training input format."""
    overlap = OVERLAP_FRAMES * FFT_HOP
    stride = WINDOW_SAMPLES - overlap
    half_frames = OVERLAP_FRAMES // 2
    padded = np.pad(audio, (overlap//2, 0))
    frame_chunks, onset_chunks, time_chunks = [], [], []
    model = _get_session()
    for offset in range(0, len(padded), stride):
        window = padded[offset:offset+WINDOW_SAMPLES]
        window = np.pad(window, (0, WINDOW_SAMPLES-len(window))).astype(np.float32)
        frames, onsets = model.run(
            ["StatefulPartitionedCall:1", "StatefulPartitionedCall:2"],
            {"serving_default_input_2:0": window.reshape(1, WINDOW_SAMPLES, 1)},
        )
        count = frames.shape[1]
        times = (offset + np.arange(count)*FFT_HOP - overlap//2) / SAMPLE_RATE
        section = slice(half_frames, count-half_frames)
        frame_chunks.append(frames[0, section])
        onset_chunks.append(onsets[0, section])
        time_chunks.append(times[section])
    frames = np.concatenate(frame_chunks)
    onsets = np.concatenate(onset_chunks)
    times = np.concatenate(time_chunks)
    valid = (times >= 0) & (times < len(audio)/SAMPLE_RATE)
    return frames[valid], onsets[valid], times[valid]


def _decode_notes(frames: np.ndarray, onsets: np.ndarray, times: np.ndarray, duration: float) -> list[dict]:
    """Activation thresholding plus onset splitting; scores are not probabilities."""
    notes: list[dict] = []
    if len(times) < 2:
        return notes
    step = FFT_HOP / SAMPLE_RATE
    for pitch_index in range(frames.shape[1]):
        values = frames[:, pitch_index]
        active = values >= 0.3
        # Fill only brief interior gaps; do not connect distinct released notes.
        for i in range(1, len(active)-1):
            if not active[i] and active[i-1] and active[i+1]:
                active[i] = True
        edges = np.diff(np.r_[False, active, False].astype(np.int8))
        starts, ends = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)
        peaks, _ = find_peaks(onsets[:, pitch_index], height=0.5, distance=max(1, round(0.1/step)), prominence=0.1)
        for first, last in zip(starts, ends):
            boundaries = [first] + [int(p) for p in peaks if p >= first+5 and p < last-5] + [last]
            for left, right in zip(boundaries, boundaries[1:]):
                start = max(0.0, float(times[left]))
                end = min(duration, float(times[min(right-1, len(times)-1)]) + step)
                if end-start < 0.1:
                    continue
                confidence = float(np.clip(np.mean(values[left:right]), 0, 1))
                # Weak short octave harmonics are common in isolated keyboard
                # audio. Prefer a smaller reviewable draft to low-activation
                # extra voices; this may omit quiet notes in mixed recordings.
                if confidence < 0.4:
                    continue
                notes.append({"midi": pitch_index+21, "start": round(start,4), "end": round(end,4), "confidence": round(confidence,4)})
    return sorted(notes, key=lambda note: (note["start"], note["midi"]))


def _chord_suggestions(notes: list[dict], duration: float) -> list[dict]:
    """Conservative triad labels only when three recognized pitch classes overlap.

    This does not determine harmonic function, key, inversions, extended chords,
    or a film arrangement. Extra simultaneously active pitch classes suppress
    the suggestion rather than being forced into a major/minor template.
    """
    names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]
    boundaries = sorted({0.0, duration, *(note["start"] for note in notes), *(note["end"] for note in notes)})
    suggestions: list[dict] = []
    for start, end in zip(boundaries, boundaries[1:]):
        if end-start < 0.025:
            continue
        midpoint = (start+end)/2
        active = [note for note in notes if note["start"] <= midpoint < note["end"]]
        pitch_classes = {note["midi"] % 12 for note in active}
        if len(pitch_classes) != 3:
            continue
        for root in range(12):
            for quality, intervals in [("major", (0,4,7)), ("minor", (0,3,7))]:
                if pitch_classes != {(root+interval)%12 for interval in intervals}:
                    continue
                voices = [max((note for note in active if note["midi"] % 12 == pitch_class), key=lambda note: note["confidence"]) for pitch_class in sorted(pitch_classes)]
                pitches = sorted(note["midi"] for note in voices)
                confidence = min(note["confidence"] for note in voices)
                label = names[root] + ("m" if quality == "minor" else "")
                if suggestions and suggestions[-1]["label"] == label and suggestions[-1]["notes"] == pitches and abs(suggestions[-1]["end"]-start) < 0.03:
                    suggestions[-1]["end"] = round(end,4)
                    suggestions[-1]["confidence"] = min(suggestions[-1]["confidence"], confidence)
                else:
                    suggestions.append({"label": label, "start": round(start,4), "end": round(end,4), "confidence": confidence, "notes": pitches})
    return [chord for chord in suggestions if chord["end"]-chord["start"] >= 0.15]


def transcribe_audio(path: str | Path, start_seconds: float = 0, end_seconds: float | None = None) -> dict:
    audio, source_start, source_end = _read_excerpt(path, start_seconds, end_seconds)
    duration = len(audio)/SAMPLE_RATE
    warnings = [
        "Machine-generated draft: review notes and timing against the recording before practising.",
        "Best on a clear solo instrument. Mixed vocals, drums and accompaniment may produce missing, extra, or octave-shifted notes; the model does not isolate a lead melody.",
        "Confidence values are model activation strengths, not calibrated probabilities. Chord labels are conservative major/minor triad suggestions, not a verified arrangement.",
    ]
    if np.max(np.abs(audio), initial=0) < 0.0001:
        notes = []
    else:
        frames, onsets, times = _predict_frames(audio)
        notes = _decode_notes(frames, onsets, times, duration)
    if not notes:
        warnings.insert(0, "No confident notes were found in this passage. Try a clearer recording or another range.")
    return {
        "engine": "basic-pitch-onnx-0.4.0", "polyphonic": True,
        "notes": notes, "chords": _chord_suggestions(notes, duration),
        "duration": round(duration,4), "sourceStart": source_start, "sourceEnd": source_end,
        # Beat tracking is intentionally not guessed from note events.
        "tempo": None, "warnings": warnings,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download-model", action="store_true", help="Download and verify the pinned Basic Pitch ONNX weights")
    args = parser.parse_args()
    if args.download_model:
        print(f"Verified model ready: {download_model()}")
    else:
        parser.error("Use --download-model to prepare the model. Requests never download models.")
