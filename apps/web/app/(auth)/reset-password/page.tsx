import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FORGOT_PASSWORD_PATH, getCurrentUser } from "@/lib/auth";
import { AuthLoading } from "../_components/auth-chrome";
import { ErrorPanel } from "../_components/error-panel";
import { ResetForm } from "../_components/reset-form";

/** Needs the session the recovery link created. Without one, ask for a new link. */
async function Content() {
  const user = await getCurrentUser();
  if (user === null) redirect(FORGOT_PASSWORD_PATH);
  if (user === "unavailable") return <ErrorPanel />;
  return <ResetForm />;
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <Content />
    </Suspense>
  );
}
