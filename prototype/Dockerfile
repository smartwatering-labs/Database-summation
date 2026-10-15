FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_ENV=production \
    HOST=0.0.0.0 \
    PORT=5000 \
    DEMO_ENABLED=0
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --uid 10001 watering
COPY app.py ./
COPY engine ./engine
COPY knowledge_base ./knowledge_base
COPY templates ./templates
COPY static ./static
RUN mkdir -p /app/instance && chown watering:watering /app/instance
USER watering
EXPOSE 5000
CMD ["python", "app.py"]
