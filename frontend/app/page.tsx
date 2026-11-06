"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

type Difficulty = "Easy" | "Medium" | "Hard";
type Message = { role: "interviewer" | "candidate"; content: string };
type Screen = "start" | "interview" | "report";
type Report = {
  score: number;
  strengths: string[];
  weaknesses: string[];
  topics_to_revise: string[];
  verdict: string;
  result: "Pass" | "Fail";
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, body?: unknown): Promise<T> {
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail ?? "The server returned an unexpected error.");
    return data as T;
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("The interview server is unavailable. Start the backend and try again.");
    }
    throw error;
  }
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("start");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("Medium");
  const [messages, setMessages] = useState<Message[]>([]);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [reportError, setReportError] = useState("");

  const start = async (event: FormEvent) => {
    event.preventDefault();
    if (!topic.trim()) {
      setError("Enter a technical topic to begin.");
      return;
    }
    setBusy(true); setError("");
    try {
      const data = await request<{ message: string }>("/api/interviews/start", { topic: topic.trim(), difficulty });
      setMessages([{ role: "interviewer", content: data.message }]);
      setScreen("interview");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not start the interview."); }
    finally { setBusy(false); }
  };

  const submitAnswer = async () => {
    if (!answer.trim() || busy) return;
    const candidateMessage = answer.trim();
    const nextMessages = [...messages, { role: "candidate" as const, content: candidateMessage }];
    setMessages(nextMessages); setAnswer(""); setBusy(true); setError("");
    try {
      const data = await request<{ message: string; ended: boolean }>("/api/interviews/answer", {
        topic, difficulty, conversation: nextMessages
      });
      const completeMessages = [...nextMessages, { role: "interviewer" as const, content: data.message }];
      setMessages(completeMessages);
      if (data.ended) {
        setReport(null); setReportError(""); setScreen("report");
        try {
          const reportData = await request<Report>("/api/interviews/report", { topic, difficulty, conversation: completeMessages });
          setReport(reportData);
        } catch (err) {
          setReportError(err instanceof Error ? err.message : "The report could not be generated.");
        }
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Could not submit your answer."); }
    finally { setBusy(false); }
  };

  const reset = () => { setScreen("start"); setMessages([]); setReport(null); setReportError(""); setAnswer(""); setError(""); };

  if (screen === "start") return (
    <main className="shell start-shell">
      <div className="brand-mark">AI</div>
      <p className="eyebrow">TECHNICAL INTERVIEW PRACTICE</p>
      <h1>AI Interview Coach</h1>
      <p className="tagline">Think clearly. Explain deeply. Get interview-ready.</p>
      <form className="start-card" onSubmit={start}>
        <label htmlFor="topic">What do you want to practice?</label>
        <input id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Binary Trees" autoFocus />
        <label>Choose your difficulty</label>
        <div className="difficulty-group">
          {(["Easy", "Medium", "Hard"] as Difficulty[]).map((level) => (
            <button type="button" className={difficulty === level ? "selected" : ""} onClick={() => setDifficulty(level)} key={level}>{level}</button>
          ))}
        </div>
        <button className="primary-button" disabled={busy}>{busy ? "Preparing your interview..." : "Start Interview →"}</button>
        {error && <p className="error">{error}</p>}
      </form>
      <p className="microcopy">Adaptive questions · Honest feedback · No model answers</p>
    </main>
  );

  if (screen === "interview") return (
    <main className="shell">
      <header className="topbar"><div className="wordmark"><span>AI</span> Interview Coach</div><div className="session-meta"><strong>{topic}</strong><span>{difficulty}</span></div></header>
      <section className="interview-layout">
        <div className="section-heading"><p className="eyebrow">LIVE INTERVIEW</p><h2>Show me how you think.</h2><p>Take your time. The interviewer will adapt to your answers.</p></div>
        <div className="chat" aria-live="polite">
          {messages.map((message, index) => <div className={`message-row ${message.role}`} key={`${message.role}-${index}`}><div className="avatar">{message.role === "interviewer" ? "AI" : "YOU"}</div><div className="bubble">{message.content}</div></div>)}
          {busy && <div className="message-row interviewer"><div className="avatar">AI</div><div className="bubble thinking"><i /><i /><i /></div></div>}
        </div>
        <div className="answer-area">
          <textarea value={answer} disabled={busy} onChange={(e) => setAnswer(e.target.value)} onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submitAnswer(); } }} placeholder="Type your answer..." rows={3} />
          <div className="answer-footer"><span>Press Enter to send · Shift + Enter for a new line</span><button className="send-button" disabled={busy || !answer.trim()} onClick={() => void submitAnswer()}>Send answer ↑</button></div>
          {error && <p className="error">{error}</p>}
        </div>
      </section>
    </main>
  );

  const retryReport = async () => {
    setReportError("");
    try {
      const reportData = await request<Report>("/api/interviews/report", { topic, difficulty, conversation: messages });
      setReport(reportData);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : "The report could not be generated.");
    }
  };
  return <ReportView report={report} reportError={reportError} topic={topic} difficulty={difficulty} onReset={reset} onRetry={() => void retryReport()} />;
}

function ReportView({ report, reportError, topic, difficulty, onReset, onRetry }: { report: Report | null; reportError: string; topic: string; difficulty: Difficulty; onReset: () => void; onRetry: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ behavior: "smooth" }); }, []);
  if (reportError) return <main className="shell report-loading"><div className="brand-mark">AI</div><h2>We couldn&apos;t finish your report.</h2><p>{reportError}</p><button className="primary-button retry-button" onClick={onRetry}>Try again</button><button className="text-button" onClick={onReset}>Start new interview</button></main>;
  if (!report) return <main className="shell report-loading"><div className="brand-mark">AI</div><h2>Reviewing your interview...</h2><p>Building your personalized report.</p><div className="loader" /></main>;
  const scoreClass = report.score >= 70 ? "good" : report.score >= 55 ? "okay" : "weak";
  return <main className="shell report-shell" ref={ref}><header className="topbar"><div className="wordmark"><span>AI</span> Interview Coach</div><button className="text-button" onClick={onReset}>Start new ↗</button></header><section className="report-content"><p className="eyebrow">INTERVIEW COMPLETE</p><h1>Your interview report</h1><p className="report-meta">{topic} <b>·</b> {difficulty}</p><div className="score-card"><div><p className="eyebrow">FINAL SCORE</p><div className={`score ${scoreClass}`}>{report.score}<small>/100</small></div></div><div className={`result ${report.result.toLowerCase()}`}>{report.result}<span>{report.result === "Pass" ? "Strong performance" : "Keep practicing"}</span></div></div><div className="report-grid"><ReportSection title="What you did well" items={report.strengths} /><ReportSection title="Areas for improvement" items={report.weaknesses} /><ReportSection title="Topics to revise" items={report.topics_to_revise} /></div><div className="verdict"><p className="eyebrow">OVERALL VERDICT</p><p>{report.verdict}</p></div><button className="primary-button report-button" onClick={onReset}>Start a new interview →</button></section></main>;
}

function ReportSection({ title, items }: { title: string; items: string[] }) {
  return <div className="report-section"><h3>{title}</h3>{items.length ? <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="muted">Nothing specific to add.</p>}</div>;
}
