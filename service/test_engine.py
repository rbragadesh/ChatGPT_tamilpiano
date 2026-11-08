"""Tests use generated tones, never distributed commercial song audio.

The model tests run the actual CPU ONNX network, not a mocked transcription.
They establish a small isolated-instrument baseline, not film-mix accuracy.
"""
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

import engine


def piano_tone(midi: int, seconds: float, rate: int = 22050) -> np.ndarray:
    time = np.arange(int(rate * seconds)) / rate
    frequency = 440 * 2 ** ((midi-69)/12)
    envelope = np.minimum(time/.01, 1) * np.exp(-time*1.8)
    return (sum(np.sin(2*np.pi*frequency*harmonic*time)/harmonic for harmonic in range(1,5)) * envelope * .25).astype(np.float32)


def write_sequence(path: Path, rate: int = 22050) -> None:
    audio = np.zeros(rate*5, dtype=np.float32)
    for index, midi in enumerate([60,62,64,67]):
        tone = piano_tone(midi, .65, rate)
        start = int((index+.5)*rate)
        audio[start:start+len(tone)] += tone
    sf.write(path, audio, rate)


def test_pinned_model_is_available_and_intact():
    # Setup must prepare the model. A skipped model test cannot establish readiness.
    assert engine.model_available(), "Run python service/engine.py --download-model before testing"
    assert engine.ensure_model().is_file()


def test_real_neural_sequence_detects_four_pitches_with_times(tmp_path):
    path = tmp_path / "sequence.wav"
    write_sequence(path)
    result = engine.transcribe_audio(path)
    assert result["engine"] == "basic-pitch-onnx-0.4.0"
    assert result["polyphonic"] is True
    assert [note["midi"] for note in result["notes"]] == [60,62,64,67]
    for index, note in enumerate(result["notes"]):
        assert abs(note["start"]-(index+.5)) < .12
        assert .5 < note["end"]-note["start"] < .9
        assert .4 <= note["confidence"] <= 1
    assert result["chords"] == []
    assert result["tempo"] is None
    assert result["warnings"]


def test_real_neural_polyphonic_triad_and_conservative_chord(tmp_path):
    path = tmp_path / "chord.wav"
    audio = np.zeros(22050*3, dtype=np.float32)
    chord = sum(piano_tone(midi, 1.8) for midi in [60,64,67]) * .45
    audio[11025:11025+len(chord)] += chord
    sf.write(path, audio, 22050)
    result = engine.transcribe_audio(path)
    assert {note["midi"] for note in result["notes"]} >= {60,64,67}
    assert any(chord["label"] == "C" and chord["notes"] == [60,64,67] for chord in result["chords"])
    assert all(chord["end"] > chord["start"] for chord in result["chords"])


def test_excerpt_crops_before_inference_and_resamples(tmp_path):
    path = tmp_path / "sequence48k.wav"
    write_sequence(path, 48000)
    result = engine.transcribe_audio(path, 2.25, 3.25)
    assert result["sourceStart"] == 2.25
    assert result["sourceEnd"] == 3.25
    assert abs(result["duration"]-1) < .001
    assert [note["midi"] for note in result["notes"]] == [64]
    assert .1 < result["notes"][0]["start"] < .35
    assert result["notes"][0]["end"] <= 1


def test_silence_returns_empty_draft_without_fake_score(tmp_path):
    path = tmp_path / "silence.wav"
    sf.write(path, np.zeros(22050), 22050)
    result = engine.transcribe_audio(path)
    assert result["notes"] == []
    assert result["chords"] == []
    assert "No confident notes" in result["warnings"][0]


@pytest.mark.parametrize("start,end", [(-1,1),(0,0),(1,.5),(0,61),(10,11),(float("nan"),1),(0,float("inf"))])
def test_invalid_ranges_rejected_before_network_or_inference(tmp_path, start, end):
    path = tmp_path / "valid.wav"
    sf.write(path, np.zeros(22050*2), 22050)
    with pytest.raises(ValueError):
        engine.transcribe_audio(path, start, end)


def test_missing_and_corrupt_model_fail_closed(tmp_path, monkeypatch):
    path = tmp_path / "bad.onnx"
    monkeypatch.setattr(engine, "MODEL_PATH", path)
    assert not engine.model_available()
    with pytest.raises(FileNotFoundError):
        engine.ensure_model()
    path.write_bytes(b"not a verified model")
    assert not engine.model_available()
    with pytest.raises(FileNotFoundError):
        engine.ensure_model()


def test_extra_pitch_class_suppresses_forced_chord():
    notes = [{"midi":midi,"start":0,"end":1,"confidence":.8} for midi in [60,64,67,69]]
    assert engine._chord_suggestions(notes,1) == []


def test_different_voicings_are_not_combined_into_unplayed_chord():
    notes = [{"midi":midi,"start":0,"end":1,"confidence":.8} for midi in [60,64,67]]
    notes += [{"midi":midi,"start":1,"end":2,"confidence":.8} for midi in [64,67,72]]
    chords = engine._chord_suggestions(notes,2)
    assert [chord["notes"] for chord in chords] == [[60,64,67],[64,67,72]]
