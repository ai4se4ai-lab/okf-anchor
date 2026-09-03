import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-slate-500">That asset, job, or page does not exist.</p>
      <Link href="/dashboard" className="mt-4 inline-block underline">
        Back to dashboard
      </Link>
    </div>
  );
}
