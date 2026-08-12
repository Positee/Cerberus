export default function Placeholder({ title }: { title: string }) {
  return (
    <div className="page">
      <section className="empty-note">
        <h3>{title} is next</h3>
        <p>
          This module is not built yet. Dashboard, Reporting, and Audit are ready. Tell me which one to build after
          this and it moves to the top.
        </p>
      </section>
    </div>
  );
}
