import base64

from langchain_core.messages import HumanMessage

from bisheng.workflow.nodes.base import BaseNode


class WorkflowNodeStub(BaseNode):
    def _run(self, unique_id: str):
        return {}


def build_node(image_files: list[str]) -> WorkflowNodeStub:
    node = object.__new__(WorkflowNodeStub)
    node.get_other_node_variable = lambda _: image_files
    return node


def test_contact_file_into_prompt_uses_image_data_url(tmp_path):
    image_bytes = b'\x89PNG\r\n\x1a\nimage-data'
    image_path = tmp_path / 'example.png'
    image_path.write_bytes(image_bytes)
    message = HumanMessage(content=[{'type': 'text', 'text': 'describe this image'}])

    result = build_node([str(image_path)]).contact_file_into_prompt(message, ['input.image'])

    image_block = result.content[1]
    assert image_block['type'] == 'image_url'
    data_url = image_block['image_url']['url']
    assert data_url.startswith('data:image/png;base64,')
    assert base64.b64decode(data_url.split(',', 1)[1]) == image_bytes


def test_contact_file_into_prompt_downloads_remote_image(monkeypatch, tmp_path):
    image_path = tmp_path / 'example.jpg'
    image_path.write_bytes(b'jpeg-image-data')
    image_url = 'http://minio:9000/tmp-dir/example.jpg?X-Amz-Signature=test'
    downloaded_urls = []

    def fake_file_download(url):
        downloaded_urls.append(url)
        return str(image_path), image_path.name

    monkeypatch.setattr('bisheng.workflow.nodes.base.file_download', fake_file_download)
    message = HumanMessage(content=[{'type': 'text', 'text': 'describe this image'}])

    result = build_node([image_url]).contact_file_into_prompt(message, ['input.image'])

    assert downloaded_urls == [image_url]
    data_url = result.content[1]['image_url']['url']
    assert data_url.startswith('data:image/jpeg;base64,')
    assert image_url not in data_url
