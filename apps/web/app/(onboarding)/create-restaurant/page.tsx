import { redirect } from "next/navigation";
import { Suspense } from "react";
import { listMyOrganizations } from "@/lib/actions/organization/actions";
import { loginUrl } from "@/lib/auth";
import { OnboardingLoading } from "../_components/chrome";
import { CreateRestaurantForm } from "../_components/create-restaurant-form";
import { AtCapNotice, UnavailableNotice } from "../_components/notices";

const CREATE_RESTAURANT_PATH = "/create-restaurant";

/** Signed in only. Warns before the form when the user already owns the most restaurants allowed. */
async function Content() {
  const result = await listMyOrganizations();
  if (!result.ok) {
    if (result.error.code === "unauthenticated") redirect(loginUrl(CREATE_RESTAURANT_PATH));
    return <UnavailableNotice />;
  }
  if (result.data.atCap) return <AtCapNotice />;
  return <CreateRestaurantForm />;
}

export default function CreateRestaurantPage() {
  return (
    <Suspense fallback={<OnboardingLoading />}>
      <Content />
    </Suspense>
  );
}
