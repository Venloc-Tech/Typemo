import { SentrySubscriber } from "@venloc/typemo-sentry";

const subscriber = new SentrySubscriber({ breadcrumbs: false });
const subscription = client.instrument(subscriber);
