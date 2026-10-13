FROM python:3.11-slim

# Install system dependencies for librosa (sndfile audio decoding)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Enable legacy Keras compatibility if loading Keras 2 models in TF 2.16
ENV TF_USE_LEGACY_KERAS=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source and models
COPY . .

EXPOSE 8000

CMD ["uvicorn", "src.app:app", "--host", "0.0.0.0", "--port", "8000"]