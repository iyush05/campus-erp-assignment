import CampusApp from './workspace';
import { getChatGPTUser } from './chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await getChatGPTUser();
  return <CampusApp owner={user?.userId ?? null} localAuth={import.meta.env.DEV} />;
}
