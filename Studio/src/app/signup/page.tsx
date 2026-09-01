'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const supabase = createClient();
    
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
          }
        }
      });
      
      if (error) {
        throw new Error(error.message);
      }

      // Fire-and-forget welcome email. The endpoint reads the recipient from
      // the freshly-set session, so we don't pass the address ourselves.
      fetch('/api/email/welcome', { method: 'POST' }).catch(() => {});

      // Supabase auto-logs in after signup if email conf isn't required. We can redirect.
      router.push('/dashboard');
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen lg:h-screen lg:overflow-hidden bg-[#F8F6F0] font-sans text-[#141414]">
      {/* Left side - Visual Grid */}
      <div className="hidden lg:flex w-1/2 items-center justify-center p-8 bg-[#F8F6F0]">
        <div className="relative w-full max-w-lg aspect-square bg-[#FF6B35] rounded-[2.5rem] p-8 grid grid-cols-2 gap-4 items-center justify-items-center overflow-hidden shadow-2xl">
            <div className="absolute inset-0 opacity-10 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-white blur-3xl"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-white blur-3xl"></div>
            </div>
            
            <div className="relative w-full aspect-square flex items-center justify-center">
                <Image src="/icon_4.png" alt="Crew 1" width={180} height={180} className="object-contain drop-shadow-lg" />
            </div>
            <div className="relative w-full aspect-square flex items-center justify-center">
                <Image src="/icon_3.png" alt="Crew 2" width={180} height={180} className="object-contain drop-shadow-lg" />
            </div>
            <div className="relative w-full aspect-square flex items-center justify-center">
                <Image src="/icon_2.png" alt="Crew 3" width={180} height={180} className="object-contain drop-shadow-lg" />
            </div>
            <div className="relative w-full aspect-square flex items-center justify-center">
                <Image src="/icon_1.png" alt="Crew 4" width={180} height={180} className="object-contain drop-shadow-lg" />
            </div>
        </div>
      </div>

      {/* Right side - Form */}
      <div className="w-full lg:w-1/2 flex flex-col items-center justify-center p-6 lg:p-16 bg-[#F8F6F0]">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-5xl lg:text-7xl font-black tracking-tighter leading-tight text-[#141414]">
              Time to build<br/>your AI crew!
            </h1>
            <p className="text-lg font-bold text-[#141414] pt-2">
              Already have an account?{' '}
              <Link href="/login" className="text-[#FF6B35] hover:underline font-bold">
                Log In
              </Link>
            </p>
          </div>

          <form onSubmit={handleSignup} className="space-y-4 pt-4">
            {error && <div className="text-red-500 text-sm font-bold text-center bg-red-100 rounded-lg py-2">{error}</div>}
            <div className="space-y-4">
              <div>
                <input
                  id="name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-8 py-5 bg-transparent border border-[#141414]/30 rounded-[2rem] focus:outline-none focus:border-[#141414] transition-colors text-lg font-bold text-[#141414] placeholder:text-[#141414] placeholder:font-bold"
                  placeholder="Full Name *"
                />
              </div>

              <div>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-8 py-5 bg-transparent border border-[#141414]/30 rounded-[2rem] focus:outline-none focus:border-[#141414] transition-colors text-lg font-bold text-[#141414] placeholder:text-[#141414] placeholder:font-bold"
                  placeholder="E-mail address *"
                />
              </div>

              <div>
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-8 py-5 bg-transparent border border-[#141414]/30 rounded-[2rem] focus:outline-none focus:border-[#141414] transition-colors text-lg font-bold text-[#141414] placeholder:text-[#141414] placeholder:font-bold"
                  placeholder="Password *"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-5 bg-[#FF6B35] text-[#141414] border border-[#141414] font-black text-xl rounded-full hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {loading ? 'Creating crew...' : 'Get Started'}
              </button>
            </div>
          </form>

          <p className="text-center pt-6 text-sm font-bold text-[#141414]">
            By connecting to CrewBlocks you agree to our{' '}
            <Link href="/terms" className="underline hover:text-[#FF6B35] transition-colors font-black">
              Terms of Use
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="underline hover:text-[#FF6B35] transition-colors font-black">
              Privacy Policy
            </Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
