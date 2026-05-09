# Indonesian TTS + Whisper STT service

A small FastAPI wrapper around [Wikidepia/indonesian-tts](https://github.com/Wikidepia/indonesian-tts) (Coqui VITS, 83 Bahasa voices) and `openai/whisper-large-v3` for offline transcription.

Normally **you don't run this script directly** — the root `./run.sh` spawns it
alongside the dashboard, inside the same `torch-gpu` conda env. Use this
script only when you want to restart or debug the ML service in isolation,
or host it on a different machine than the dashboard.

- **License note (Wikidepia):** _DO NOT USE FOR COMMERCIAL PURPOSES._
- Requires the `torch-gpu` conda env (or any env with PyTorch + CUDA; CPU works but is slow).

## Run standalone

```bash
cd idn-tts
./run.sh          # activates `torch-gpu`, fetches model files, starts service
```

First run downloads ~330 MB of model weights into `./models/`. Service listens on `http://127.0.0.1:21128` by default.

Override:
- `CONDA_ENV=other-env ./run.sh`
- `IDN_TTS_HOST=0.0.0.0 IDN_TTS_PORT=22128 ./run.sh`
- `IDN_TTS_USE_CUDA=0 ./run.sh` (force CPU)

## Voices

- `wibowo` — male, audiobook (default)
- `ardi` — male, Azure-trained
- `gadis` — female, Azure-trained
- 80 additional speakers prefixed `JV-*` (Javanese) and `SU-*` (Sundanese) — trained from Google Project Shakti data; pronunciation of generic Indonesian may drift.

## Endpoints

| | |
| --- | --- |
| `GET  /health`                | service + model status |
| `GET  /speakers`              | `{speakers: [...], named: [...], default: "wibowo"}` |
| `POST /synthesize`            | `{text, speaker?, split_sentences?}` → `audio/wav` |
| `POST /v1/audio/speech`       | OpenAI-style `{model, input, voice?}` → `audio/wav` |

Empty text → 422. Unknown speaker → 400 with a list of named speakers.

## Manual test

```bash
curl -X POST http://127.0.0.1:21128/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text":"Halo, apa kabar?","speaker":"wibowo"}' \
  -o /tmp/hello.wav
```

## How the pipeline works

1. `g2p-id` (Wikidepia v0.0.4) converts graphemes → IPA phonemes.
   Example: `"saya sedang berada di jakarta."` → `"saja sədaŋ bərada di dʒakarta."`
2. The VITS model consumes phoneme text and emits a float32 waveform at 22050 Hz.
3. We encode it as 16-bit mono WAV on the way out.

## Directory

```
idn-tts/
├── service.py          # FastAPI app
├── run.sh              # startup (activates torch-gpu)
├── download.sh         # fetch v1.2 release assets
├── requirements.txt
├── models/             # populated by download.sh
│   ├── checkpoint_1260000-inference.pth
│   ├── config.json
│   └── speakers.pth
└── README.md
```

## Troubleshooting

**`Could not load this library: libtorchaudio.so`**
`torchaudio` version doesn't match your PyTorch. Reinstall with a matching build:
```bash
pip install --upgrade "torchaudio==$(python -c 'import torch; print(torch.__version__.split("+")[0])').*" \
  --index-url https://download.pytorch.org/whl/cu128
```
(replace `cu128` with `cu121`, `cu124`, etc. as appropriate)

**`FileNotFoundError: speakers.pth`**
The bundled `config.json` points to `speakers.pth` by relative path. The service `cd`s into `models/` during load to resolve that; if you're running the script standalone, do the same.

**First request is slow**
The VITS model warm-up path is lazy. First synthesis may take 2–3× longer; subsequent calls stabilise around real-time on a modern GPU.
