export const isGrapeSeedTokenValid = () => {
  const token = localStorage.getItem('grapeseed_token');
  if (!token) return false;
  
  try {
    // Basic JWT expiration check (if your token is a standard JWT)
    const payload = JSON.parse(atob(token.split('.')[1]));
    const expiry = payload.exp * 1000;
    return Date.now() < expiry;
  } catch {
    return !!token; // Fallback to just checking existence if not a JWT
  }
};