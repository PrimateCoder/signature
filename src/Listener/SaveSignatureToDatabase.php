<?php

/*
 * This file is part of fof/signature.
 *
 * Copyright (c) FriendsOfFlarum.
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace FoF\Signature\Listener;

use Flarum\Settings\SettingsRepositoryInterface;
use Flarum\User\Event\Saving;
use Flarum\User\User;
use FoF\Signature\Event\SignatureSaved;
use FoF\Signature\Event\SignatureSaving;
use FoF\Signature\Formatter\SignatureFormatter;
use FoF\Signature\Validator\SignatureValidator;
use Illuminate\Contracts\Events\Dispatcher;
use Illuminate\Support\Arr;
use Illuminate\Support\Str;

class SaveSignatureToDatabase
{
    public function __construct(
        protected SettingsRepositoryInterface $settings,
        protected Dispatcher $events,
        protected SignatureValidator $validator,
        protected SignatureFormatter $formatter
    ) {
    }

    public function handle(Saving $event): void
    {
        $attributes = Arr::get($event->data, 'attributes', []);
        if (!Arr::exists($attributes, 'signature')) {
            return;
        }

        $user = $event->user;
        $actor = $event->actor;

        $this->checkPermissions($actor, $user);
        $this->processSignature($attributes, $user, $actor);
    }

    protected function processSignature(array $attributes, User $user, User $actor): void
    {
        $this->validator->assertValid(Arr::only($attributes, 'signature'));
        $signature = Str::of(Arr::get($attributes, 'signature'))->trim();

        $user->signature = $signature->isEmpty() ? null : $this->formatter->parse($signature);

        if ($user->isDirty('signature')) {
            $this->dispatchEvents($user, $actor);
        }
    }

    protected function dispatchEvents(User $user, User $actor): void
    {
        $this->events->dispatch(new SignatureSaving($user, $actor->id === $user->id ? null : $actor));
        $user->afterSave(function (User $user) use ($actor) {
            $user->raise(new SignatureSaved($user, $actor->id === $user->id ? null : $actor));
        });
    }

    protected function checkPermissions(User $actor, User $user): void
    {
        $user->assertCan('haveSignature');

        if ($actor->id !== $user->id) {
            $actor->assertCan('moderateSignature');
        }
    }
}
