import app from 'flarum/forum/app';
import { extend, override } from 'flarum/common/extend';
import CommentPost from 'flarum/forum/components/CommentPost';
import Signature from '../components/Signature';
import SignatureState from '../states/SignatureState';

export default function extendCommentPost() {
  // Create a per-post SignatureState and register it with the SubtreeRetainer
  // so that toggling inline editing triggers a re-render of the post.
  extend(CommentPost.prototype, 'oninit', function () {
    this._signatureState = new SignatureState();
    this.subtree.check(() => this._signatureState.editing);
  });

  // While editing, allow every redraw so the TextEditor can complete its
  // internal loading cycle (it calls m.redraw.sync() to swap its
  // LoadingIndicator for the actual textarea). Must use `override` because
  // Flarum's `extend` always returns the original value and ignores the
  // callback's return.
  override(CommentPost.prototype, 'onbeforeupdate', function (original, ...args) {
    if (this._signatureState?.editing) {
      original(...args);
      return true;
    }
    return original(...args);
  });

  extend(CommentPost.prototype, 'content', function (content) {
    const user = this.attrs.post.user?.();

    if (user && user.signature() && !(this.attrs.post.isHidden() && !this.revealContent)) {
      const allowInlineEditing = app.forum.attribute<boolean>('allowInlineEditing') || false;

      content.push(
        <div className="Post-signature">
          <Signature user={user} readonly={!allowInlineEditing} state={this._signatureState} />
        </div>
      );
    }
  });
}
