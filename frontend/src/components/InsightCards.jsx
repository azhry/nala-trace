function InsightCard({ label, value, detail, tone, children }) {
  return (
    <article className={`insight-card ${tone}`}>
      <div className="insight-card-top"><span>{label}</span><span className="insight-spark" aria-hidden="true">{children}</span></div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  )
}

export default function InsightCards({ insights }) {
  return (
    <section className="insights-section" aria-labelledby="insights-title">
      <div className="section-heading-row">
        <div>
          <p className="section-label">03 / Judge the result</p>
          <h2 id="insights-title">Quality signals</h2>
          <p className="section-description">Compare deterministic checks with the human judgement that explains whether this run is useful.</p>
        </div>
        <span className="insight-period">Latest 40 sessions</span>
      </div>
      <div className="insight-grid">
        <InsightCard label="Eval checks" value={`${insights.evalPasses}/${insights.evalTotal} pass`} detail="Deterministic checks completed without a regression." tone="green"><span className="spark-check">✓</span></InsightCard>
        <InsightCard label="Judge alignment" value={`${insights.judgeAlignment}%`} detail="Human labels agree with the automated judge on this run." tone="purple"><span className="spark-bars"><i /><i /><i /><i /><i /></span></InsightCard>
        <InsightCard label="Review signal" value={insights.reviewSignal} detail="The trace has enough context for a confident handoff." tone="amber"><span className="spark-ring" /></InsightCard>
      </div>
    </section>
  )
}
