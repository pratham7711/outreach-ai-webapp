/**
 * The one import() of the chart library in the whole dashboard.
 *
 * Turbopack emits an async chunk per import() site rather than sharing one
 * across page entries, and Recharts is 362KB raw / 88KB brotli. Measured: a
 * cold /dashboard downloaded it, and a client-side navigation to /analytics
 * downloaded the same library again under a different filename. Five such
 * copies existed in the build.
 *
 * One import() expression, in one module, is one chunk -- so the second chart
 * page finds it already cached. Call sites keep their own dynamic() wrapper and
 * their own loading skeleton; only the import moved here.
 */
export const loadCharts = () => import("@/components/charts/all");
