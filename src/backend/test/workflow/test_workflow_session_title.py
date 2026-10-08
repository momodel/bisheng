from types import SimpleNamespace

from bisheng.worker.workflow import redis_callback


def test_workflow_title_uses_submitted_question_not_input_schema(monkeypatch):
    callback = redis_callback.RedisCallback.__new__(redis_callback.RedisCallback)
    callback.chat_id = "chat-1"
    callback.user_id = 7
    callback.tenant_id = 3
    callback.new_session = SimpleNamespace(chat_id="chat-1", name=None)

    seen = {}

    def get_messages(chat_id, categories, limit):
        seen["query"] = (chat_id, categories, limit)
        return [SimpleNamespace(message="1")]

    def generate_title(question, llm):
        seen["question"] = question
        return "数学题求解"

    monkeypatch.setattr(redis_callback.ChatMessageDao, "get_messages_by_chat_id", get_messages)
    monkeypatch.setattr(
        redis_callback.LLMService,
        "get_workbench_llm_sync",
        lambda tenant_id: SimpleNamespace(chat_title_llm=SimpleNamespace(id="model-1")),
    )
    monkeypatch.setattr(redis_callback.LLMService, "get_bisheng_llm_sync", lambda **_kwargs: object())
    monkeypatch.setattr(redis_callback, "generate_conversation_title_sync", generate_title)
    monkeypatch.setattr(
        redis_callback.MessageSessionDao,
        "update_session_name_sync",
        lambda chat_id, title: seen.setdefault("updated", (chat_id, title)),
    )

    callback.generate_session_title()

    assert seen["query"] == ("chat-1", ["question"], 1)
    assert seen["question"] == "1"
    assert seen["updated"] == ("chat-1", "数学题求解")
    assert callback.new_session.name == "数学题求解"
