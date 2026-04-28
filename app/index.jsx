/**
 * app/index.js
 *
 * This screen is never actually shown  the root _layout.js handles
 * all routing to eula / login / home based on auth state.
 *
 * FIX: Removed <Redirect> that was competing with router.replace()
 *      in _layout.js and causing a navigation race-condition crash.
 */
export default function Index() {
  return null;
}

