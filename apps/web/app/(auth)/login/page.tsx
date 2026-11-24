import { Suspense } from "react";
import { AuthLoading } from "../_components/auth-chrome";
import { first, linkErrorFrom, SignedOutOnly } from "../_components/gate";
import { LoginForm } from "../_components/login-form";

async function Content({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const query = await searchParams;
  const next = first(query.next);
  return (
    <SignedOutOnly next={next}>
      <LoginForm next={next} linkError={linkErrorFrom(query.error)} />
    </SignedOutOnly>
  );
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <Suspense fallback={<AuthLoading />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
