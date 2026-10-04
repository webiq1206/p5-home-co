FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core ca-certificates python3 python3-venv && rm -rf /var/lib/apt/lists/*
COPY requirements-renderer.txt ./
RUN python3 -m venv /opt/p5-renderer && /opt/p5-renderer/bin/pip install --no-cache-dir --only-binary=:all: --no-deps --require-hashes -r requirements-renderer.txt
ENV DOCUMENT_PDFIUM_PYTHON=/opt/p5-renderer/bin/python
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN /opt/p5-renderer/bin/python -I -B src/pdfium-render.py --probe
USER node
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","src/main.mjs"]
