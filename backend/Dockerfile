FROM python:3.11-slim

# Install system dependencies required for librosa audio processing and OpenCV rendering
RUN apt-get update && apt-get install -y \
    libsndfile1 \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install python packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source files and model checkpoints into container
COPY . .

EXPOSE 8000

# Launch Uvicorn server pointing to FastAPI instance
CMD ["uvicorn", "src.app:app", "--host", "0.0.0.0", "--port", "8000"]