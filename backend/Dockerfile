FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home fsm
COPY . .
USER fsm
EXPOSE 8080
CMD ["uvicorn","fsm_api:app","--host","0.0.0.0","--port","8080","--ws-max-size","16384"]
