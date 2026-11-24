import { Suspense } from "react";
import { AuthLoading } from "../_components/auth-chrome";
import { first, SignedOutOnly } from "../_components/gate";
import { SignupForm } from "../_components/signup-form";

async function Content({ searchParams }: { searchParams: PageProps<"/signup">["searchParams"] }) {
  const next = first((await searchParams).next);
  return (
    <SignedOutOnly next={next}>
      <SignupForm next={next} />
    </SignedOutOnly>
  );
}

export default function SignupPage({ searchParams }: PageProps<"/signup">) {
  return (
    <Suspense fallback={<AuthLoading />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}
