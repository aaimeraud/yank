// A DOM for the tests that render hooks (happy-dom). Imported first by those
// files only; the pure tests run without it.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
