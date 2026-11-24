import { Suspense } from "react";
import { AuthLoading } from "../_components/auth-chrome";
import { ForgotForm } from "../_components/forgot-form";
import { linkErrorFrom, SignedOutOnly } from "../_components/gate";

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/forgot-password">["searchParams"];
}) {
  const query = await searchParams;
  return (
    <SignedOutOnly>
      <ForgotForm linkError={linkErrorFrom(query.error)} />
    </SignedOutOnly>
  );
}

export default function ForgotPasswordPage({ searchParams }: PageProps<"/forgot-password">) {
  return (
    <Suspense fallback={<AuthLoading />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
