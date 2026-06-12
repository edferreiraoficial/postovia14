export const Card = ({ title, content }: { title: string, content: string }) => (
  <div className="card">
    <h3>{title}</h3>
    <p>{content}</p>
  </div>
);