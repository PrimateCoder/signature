<?php

/*
 * This file is part of fof/signature.
 *
 * Copyright (c) FriendsOfFlarum.
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace FoF\Signature\Provider;

use Flarum\Extension\ExtensionManager;
use Flarum\Foundation\AbstractServiceProvider;
use Flarum\Foundation\Paths;
use FoF\Signature\Formatter\SignatureFormatter;
use Illuminate\Contracts\Cache\Repository;
use Illuminate\Contracts\Container\Container;

class SignatureFormatterProvider extends AbstractServiceProvider
{
    public function register(): void
    {
        $this->container->singleton('fof-signature.formatter', function (Container $container) {
            return self::createFormatterInstance($container);
        });

        $this->container->alias('fof-signature.formatter', SignatureFormatter::class);
    }

    public static function createFormatterInstance(Container $container): SignatureFormatter
    {
        return new SignatureFormatter(
            $container->make(Repository::class),
            $container[Paths::class]->storage.'/formatter',
            $container->make(ExtensionManager::class)
        );
    }
}
