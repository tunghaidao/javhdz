#!/usr/bin/env python3
"""Whisper subtitle generator - usage: whipsub.py input.mp4 [model=tiny|small|medium|large]"""
import sys, os
from faster_whisper import WhisperModel

input_file = sys.argv[1]
model_size = sys.argv[2] if len(sys.argv) > 2 else "small"

out_file = os.path.splitext(input_file)[0] + "_whisper.srt"

print(f"🔊 Transcribing {os.path.basename(input_file)} with model '{model_size}'...")
model = WhisperModel(model_size, device="cpu", compute_type="int8")
segments, info = model.transcribe(input_file, language="vi")

count = 0
with open(out_file, "w", encoding="utf-8") as f:
    for i, s in enumerate(segments, 1):
        f.write(f"{i}\n{s.start:.3f} --> {s.end:.3f}\n{s.text.strip()}\n\n")
        count += 1
        if count % 10 == 0:
            print(f"  {count} segments...")

print(f"✅ {out_file} ({count} segments)")
