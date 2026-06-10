FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_TRUSTED_HOST="pypi.org files.pythonhosted.org pypi.python.org"

COPY requirements.txt .
RUN pip install --trusted-host pypi.org \
             --trusted-host files.pythonhosted.org \
             --trusted-host pypi.python.org \
             -r requirements.txt

COPY app ./app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
