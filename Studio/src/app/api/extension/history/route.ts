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
            .from('chat_history')
            .select('*')
            .eq('chatflow_id', chatflowId)
            .eq('user_id', user.id)
            .order('created_at', { ascending: true }) // Oldest first for chat UI
            .limit(100);

        if (error) {
            console.error("Chat history fetch error from supabase:", error);
            throw error;
        }

        return NextResponse.json({ history: data || [] });
    } catch (e) {
        console.error("Chat history fetch error:", e);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const chatflowId = searchParams.get('chatflowId');
        if (!chatflowId) return NextResponse.json({ error: "Missing chatflowId" }, { status: 400 });

        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { error: chatError } = await supabase
            .from('chat_history')
            .delete()
            .eq('chatflow_id', chatflowId)
            .eq('user_id', user.id);
            
        const { error: memError } = await supabase
            .from('chatflow_memory')
            .delete()
            .eq('chatflow_id', chatflowId)
            .eq('user_id', user.id);

        if (chatError || memError) {
            console.error("Delete error from supabase:", chatError || memError);
            throw (chatError || memError);
        }

        return NextResponse.json({ success: true });
    } catch (e) {
        console.error("Chat history delete error:", e);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
