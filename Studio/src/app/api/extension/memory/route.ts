import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const chatflowId = searchParams.get('chatflowId');
        if (!chatflowId) return NextResponse.json({ error: "Missing chatflowId" }, { status: 400 });

        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { data, error } = await supabase
            .from('chatflow_memory')
            .select('*')
            .eq('chatflow_id', chatflowId)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            console.error("Memory fetch error from supabase:", error);
            throw error;
        }

        return NextResponse.json({ memory: data || [] });
    } catch (e) {
        console.error("Memory fetch error:", e);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
