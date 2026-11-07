import { redirect } from 'next/navigation';
import { getChatGPTUser } from '../chatgpt-auth';
import { Login } from '../components/login';
export const dynamic = 'force-dynamic';
export default async function LoginPage() {
    if (await getChatGPTUser()) redirect('/');
    return <Login localMode={import.meta.env.DEV ? 'framework' : undefined}/>;
}
