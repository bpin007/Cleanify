import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="grid gap-3 py-16 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p>
        <Link to="/" className="text-accent-text underline">
          Go to the tool
        </Link>
      </p>
    </div>
  );
}
