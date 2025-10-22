FROM node:18-slim

# Instala dependências do Playwright
RUN apt-get update && apt-get install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxcb1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia package primeiro para cache
COPY package*.json ./
RUN npm install

# Instala o Chromium do Playwright
RUN npx playwright install chromium

# Copia o resto do código
COPY . .

EXPOSE 3000

CMD ["node", "index.js"]