import Component, { ComponentAttrs } from 'flarum/common/Component';
import User from 'flarum/common/models/User';
import app from 'flarum/forum/app';
import TextEditor from 'flarum/common/components/TextEditor';
import Stream from 'flarum/common/utils/Stream';
import SignatureState from '../states/SignatureState';
import LoadingIndicator from 'flarum/common/components/LoadingIndicator';
import type Mithril from 'mithril';

interface SignatureAttrs extends ComponentAttrs {
  user: User;
  readonly?: boolean;
  state?: SignatureState;
}

export default class Signature extends Component<SignatureAttrs> {
  signatureState!: SignatureState;
  user!: User;
  loading: boolean = false;

  oninit(vnode: Mithril.Vnode<SignatureAttrs, this>) {
    super.oninit(vnode);
    this.user = vnode.attrs.user;
    this.signatureState = this.attrs.state || new SignatureState();
    this.signatureState.setContent(Stream(this.user.signature() || ''));
  }

  view() {
    return (
      <div className={`Signature ${this.signatureState.editing ? 'editing' : ''}`}>
        {this.loading ? <LoadingIndicator /> : this.signatureState.editing ? this.renderEditor() : this.renderSignature()}
      </div>
    );
  }
  renderEditor() {
    if (this.user.canEditSignature() && !this.attrs.readonly) {
      return (
        <div class="SignatureEditor">
          <TextEditor
            value={this.signatureState.content()}
            onchange={this.signatureState.content}
            placeholder={app.translator.trans('fof-signature.forum.profile.placeholder')}
            composer={this.signatureState}
            submitLabel={app.translator.trans('fof-signature.forum.buttons.save')}
            onsubmit={this.onEditorSubmit.bind(this)}
          />
        </div>
      );
    }

    return null;
  }

  onEditorSubmit() {
    this.save();
  }

  renderSignature() {
    return (
      <div className="Signature-content" onclick={this.edit.bind(this)}>
        {!this.user.signature() ? <p>{app.translator.trans('fof-signature.forum.profile.click')}</p> : m.trust(this.user.signatureHtml())}
      </div>
    );
  }

  edit() {
    if (this.user.canEditSignature() && !this.attrs.readonly) {
      this.signatureState.toggleEditing();
      m.redraw();
    }
  }

  save() {
    const signature = this.signatureState.content();
    this.loading = true;

    this.user
      .save({ signature })
      .then(() => {
        this.loading = false;
        this.signatureState.setContent(Stream(signature));
        this.signatureState.toggleEditing();
        m.redraw();
      })
      .catch((error) => {
        this.loading = false;
        app.alerts.show(
          { type: 'error' },
          error?.alert?.content || app.translator.trans('fof-signature.forum.errors.save_failed')
        );
        m.redraw();
      });
  }
}
