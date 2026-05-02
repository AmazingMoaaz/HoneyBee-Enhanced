# --- builder ---
FROM node:20-alpine AS builder
WORKDIR /src
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# --- runtime (nginx) ---
FROM nginx:1.27-alpine
COPY --from=builder /src/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
