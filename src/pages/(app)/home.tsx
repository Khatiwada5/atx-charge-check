/**
 * /home — kept because the scaffold's tests and sign-in redirects land here.
 * The app's real home is the map, so this just forwards to /map.
 */

import { Navigate } from 'react-router-dom'

export default function HomePage() {
  return <Navigate to="/map" replace />
}
