import { revalidatePath } from "next/cache";
import { prisma } from "@/server/providers";
import { newApiToken, tokenHash, tokenPrefix } from "@/server/tokens";

export const dynamic = "force-dynamic";

async function registerServer(formData: FormData): Promise<void> {
  "use server";
  const name = String(formData.get("name") ?? "").trim();
  const publisherId = String(formData.get("publisherId") ?? "").trim();
  const publicKeyHex = String(formData.get("publicKeyHex") ?? "").trim() || null;
  if (!name || !/^[a-z0-9:_-]{3,80}$/i.test(publisherId)) {
    throw new Error("name and a publisherId (letters, digits, : _ -) are required");
  }

  const org = await prisma.organization.upsert({
    where: { slug: "demo" },
    update: {},
    create: { slug: "demo", name: "Demo Organization" },
  });

  const server = await prisma.buildServer.upsert({
    where: { publisherId },
    update: { name, publicKeyHex },
    create: { name, publisherId, publicKeyHex, organizationId: org.id },
  });

  const token = newApiToken();
  await prisma.apiCredential.create({
    data: {
      buildServerId: server.id,
      tokenPrefix: tokenPrefix(token),
      tokenHash: tokenHash(token),
      label: "created via web",
    },
  });

  // The plaintext token is shown exactly once via a redirect param.
  revalidatePath("/servers");
  const { redirect } = await import("next/navigation");
  redirect(`/servers?token=${encodeURIComponent(token)}&server=${encodeURIComponent(publisherId)}`);
}

export default async function ServersPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; server?: string }>;
}) {
  const sp = await searchParams;
  const servers = await prisma.buildServer.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { credentials: true, mintJobs: true } } },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Build servers</h1>

      {sp.token && (
        <div className="card border-emerald-400">
          <p className="text-sm font-medium">
            API token for <code>{sp.server}</code> — copy it now, it is not shown again:
          </p>
          <code className="mt-2 block break-all rounded bg-slate-100 p-2 font-mono text-xs dark:bg-slate-800">
            {sp.token}
          </code>
          <p className="mt-2 text-xs text-slate-500">
            Use it as <code>Authorization: Bearer &lt;token&gt;</code> against{" "}
            <code>POST /api/v1/bundles</code>.
          </p>
        </div>
      )}

      <form action={registerServer} className="card space-y-3">
        <h2 className="font-semibold">Register a build server</h2>
        <label className="block text-sm">
          Name
          <input name="name" required className="mt-1 w-full rounded border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-900" />
        </label>
        <label className="block text-sm">
          Publisher id <span className="text-slate-500">(e.g. build-server:prod-01)</span>
          <input name="publisherId" required className="mt-1 w-full rounded border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-900" />
        </label>
        <label className="block text-sm">
          Ed25519 public key hex <span className="text-slate-500">(optional, for signed requests)</span>
          <input name="publicKeyHex" className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs dark:border-slate-700 dark:bg-slate-900" />
        </label>
        <button className="btn" type="submit">Register &amp; issue token</button>
      </form>

      <div className="space-y-2">
        {servers.map((s) => (
          <div key={s.id} className="card flex items-center justify-between text-sm">
            <div>
              <div className="font-medium">{s.name}</div>
              <div className="text-xs text-slate-500">
                {s.publisherId} · {s.environment} · {s._count.credentials} key(s) · {s._count.mintJobs} job(s)
                {s.disabledAt && <span className="ml-2 check-fail">disabled</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
