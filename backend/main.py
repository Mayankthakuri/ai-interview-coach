import json
import os
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq, APIError
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))

Difficulty = Literal["Easy", "Medium", "Hard"]
Role = Literal["interviewer", "candidate"]

class Message(BaseModel):
    role: Role
    content: str = Field(min_length=1, max_length=10000)

class InterviewRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=200)
    difficulty: Difficulty
    conversation: list[Message] = Field(default_factory=list, max_length=40)

class AnswerResponse(BaseModel):
    message: str
    ended: bool

class Report(BaseModel):
    score: int = Field(ge=0, le=100)
    strengths: list[str]
    weaknesses: list[str]
    topics_to_revise: list[str]
    verdict: str
    result: Literal["Pass", "Fail"]

app = FastAPI(title="AI Interview Coach API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def groq_client() -> Groq:
    key = os.getenv("GROQ_API_KEY")
    if not key or key == "your_groq_api_key_here":
        raise HTTPException(status_code=503, detail="Groq is not configured. Add GROQ_API_KEY to backend/.env and restart the server.")
    return Groq(api_key=key)

def transcript(messages: list[Message]) -> str:
    return "\n".join(f"{m.role.upper()}: {m.content}" for m in messages)

INTERVIEW_SYSTEM = """You are a professional technical interviewer. Interview one candidate on {topic} at {difficulty} difficulty.
Difficulty guidance: Easy tests basic definitions and recall; Medium tests applied problems; Hard tests trade-offs and system thinking.
The conversation is supplied below. Return ONLY valid JSON with exactly two keys: "message" (string, what the interviewer says next) and "ended" (boolean).
Ask exactly one question at a time. If the last answer is strong, acknowledge briefly and ask a different aspect. If partly right, ask one probing follow-up without revealing the answer. If wrong, note the gap in one line and move on. Never teach, hint, or give the answer. Stay professional and encouraging.
End early if the candidate is clearly struggling across several questions. If doing very well, end once key areas are covered. When ending, "message" should be a brief closing sentence and "ended" must be true. Otherwise ended must be false."""

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

@app.post("/api/interviews/start")
def start_interview(request: InterviewRequest) -> dict[str, str]:
    if request.conversation:
        raise HTTPException(status_code=400, detail="A new interview cannot include previous messages.")
    try:
        completion = groq_client().chat.completions.create(
            model="llama-3.3-70b-versatile",
            temperature=0.5,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": INTERVIEW_SYSTEM.format(topic=request.topic, difficulty=request.difficulty)},
                {"role": "user", "content": "Start the interview with the first question. Do not end it."},
            ],
        )
        data = json.loads(completion.choices[0].message.content or "{}")
        if not isinstance(data.get("message"), str):
            raise ValueError("Invalid interviewer response")
        return {"message": data["message"]}
    except (APIError, ValueError, json.JSONDecodeError) as exc:
        detail = "The interviewer could not start right now. Check your Groq key and try again."
        print(f"Start interview error: {exc}")
        raise HTTPException(status_code=502, detail=detail) from exc

@app.post("/api/interviews/answer", response_model=AnswerResponse)
def answer_interview(request: InterviewRequest) -> AnswerResponse:
    if not request.conversation or request.conversation[-1].role != "candidate":
        raise HTTPException(status_code=400, detail="Submit a candidate answer before asking the next question.")
    try:
        completion = groq_client().chat.completions.create(
            model="llama-3.3-70b-versatile",
            temperature=0.5,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": INTERVIEW_SYSTEM.format(topic=request.topic, difficulty=request.difficulty)},
                {"role": "user", "content": transcript(request.conversation)},
            ],
        )
        data = json.loads(completion.choices[0].message.content or "{}")
        if not isinstance(data.get("message"), str) or not isinstance(data.get("ended"), bool):
            raise ValueError("Invalid interviewer response")
        return AnswerResponse(message=data["message"], ended=data["ended"])
    except (APIError, ValueError, json.JSONDecodeError) as exc:
        print(f"Answer interview error: {exc}")
        raise HTTPException(status_code=502, detail="The interviewer could not respond right now. Please try again.") from exc

REPORT_SYSTEM = """You are evaluating a technical interview about {topic} at {difficulty} difficulty.
Return ONLY valid JSON matching this schema: {{"score": integer 0-100, "strengths": ["..."], "weaknesses": ["..."], "topics_to_revise": ["..."], "verdict": "...", "result": "Pass" or "Fail"}}.
Use 85+ excellent, 70-84 good, 55-69 adequate, below 55 weak. Pass means score >= 55.
Strengths and weaknesses must cite concrete things the candidate actually said, not generic praise. Be concise, fair, and specific."""

@app.post("/api/interviews/report", response_model=Report)
def generate_report(request: InterviewRequest) -> Report:
    if len(request.conversation) < 2:
        raise HTTPException(status_code=400, detail="There is not enough interview data to generate a report.")
    try:
        completion = groq_client().chat.completions.create(
            model="llama-3.3-70b-versatile",
            temperature=0.2,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": REPORT_SYSTEM.format(topic=request.topic, difficulty=request.difficulty)},
                {"role": "user", "content": transcript(request.conversation)},
            ],
        )
        data = json.loads(completion.choices[0].message.content or "{}")
        return Report.model_validate(data)
    except (APIError, ValueError, json.JSONDecodeError) as exc:
        print(f"Report error: {exc}")
        raise HTTPException(status_code=502, detail="The report could not be generated right now. Please retry.") from exc

if __name__ == "__main__":
    import uvicorn
    print("AI Interview Coach API running at http://localhost:8000")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
