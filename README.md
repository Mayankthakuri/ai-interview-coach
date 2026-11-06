# AI Interview Coach

Next.js frontend and FastAPI backend for an adaptive technical interview coach.

## Setup

### Backend

From the project root:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Put your Groq API key in .env
python main.py
```

The API runs at `http://localhost:8000` and its health check is `http://localhost:8000/health`.

### Frontend

In another terminal:

```bash
cd "/Users/mayankchand/new/ai interview coach"
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.
