FROM python:3.13-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        nmap sudo iputils-ping iproute2 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 app \
    && echo "app ALL=(root) NOPASSWD: /usr/bin/nmap" > /etc/sudoers.d/networklist-nmap \
    && chmod 0440 /etc/sudoers.d/networklist-nmap

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN mkdir -p /data && chown app:app /data

USER app

ENV DATABASE_URL=sqlite:////data/networklist.db
ENV PORT=8000

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
