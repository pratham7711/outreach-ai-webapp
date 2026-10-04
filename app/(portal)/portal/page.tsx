import { redirect } from "next/navigation";

/* /portal had no page of its own and answered 404 -- the address a creator is
   most likely to type, and the one a reviewer types first. The dashboard does
   its own sign-in check. */
export default function PortalIndex() {
  redirect("/portal/dashboard");
}
