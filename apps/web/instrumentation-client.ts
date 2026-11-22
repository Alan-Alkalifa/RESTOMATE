import { capturePageview, initAnalytics } from "./lib/analytics/client";

initAnalytics();

export function onRouterTransitionStart(url: string) {
  capturePageview(url);
}
