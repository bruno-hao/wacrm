import { redirect } from 'next/navigation';

// "Avisos" became ZapÓtica; keep old links and bookmarks working.
export default function AvisosRedirect() {
  redirect('/zapotica');
}
