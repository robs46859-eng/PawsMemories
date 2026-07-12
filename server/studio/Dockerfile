FROM python:3.11-slim

# System deps for audio/video processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    # Blender headless
    blender \
    # Audio deps
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (layer-cached)
COPY server/studio/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY server/studio ./studio

# Non-root user
RUN useradd -m studio && chown -R studio /app
USER studio

ENV PYTHONPATH=/app
ENV PORT=8001

EXPOSE 8001

CMD ["uvicorn", "studio.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]
